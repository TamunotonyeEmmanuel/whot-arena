import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

const bg = Color(0xFF071C16);
const green = Color(0xFF00C896);
const gold = Color(0xFFFFD166);
const apiBaseUrl = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000');
String get webSocketUrl =>
    '${apiBaseUrl.replaceFirst(RegExp(r'^http'), 'ws')}/ws';

void main() => runApp(const ArenaApp());

class ArenaApp extends StatelessWidget {
  const ArenaApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'WHOT Arena',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: bg,
          colorScheme: ColorScheme.fromSeed(
              seedColor: green, brightness: Brightness.dark),
          useMaterial3: true,
        ),
        home: const ArenaHome(),
      );
}

class ArenaHome extends StatefulWidget {
  const ArenaHome({super.key});
  @override
  State<ArenaHome> createState() => _ArenaHomeState();
}

class _ArenaHomeState extends State<ArenaHome> {
  final name = TextEditingController(text: 'Guest');
  final roomCode = TextEditingController();
  final authEmail = TextEditingController();
  final authPassword = TextEditingController();
  final authUsername = TextEditingController();
  WebSocketChannel? channel;
  Map<String, dynamic>? state;
  String? pid, code, reconnectToken, accessToken, error;
  bool busy = false;
  bool initializing = true;
  bool registering = false;
  bool obscurePassword = true;
  bool teamMode = false;
  final Map<String, dynamic> rules = {
    'cards_per_player': 5,
    'pick_two': 2,
    'pick_three': 3,
    'pick_three_enabled': true,
    'general_market': 1,
    'penalty_stacking': true,
  };

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      name.text = prefs.getString('name') ?? 'Guest';
      pid = prefs.getString('pid');
      code = prefs.getString('code');
      reconnectToken = prefs.getString('reconnect_token');
      accessToken = prefs.getString('access_token');
      initializing = false;
    });
    await loadGameRules();
  }

  Future<void> loadGameRules() async {
    try {
      final response = await http
          .get(apiUri('/api/game-rules'))
          .timeout(const Duration(seconds: 5));
      if (response.statusCode >= 400) {
        throw Exception('Request failed (${response.statusCode})');
      }
      final values =
          Map<String, dynamic>.from(jsonDecode(response.body) as Map);
      if (values['cards_per_player'] is! int ||
          values['pick_two'] is! int ||
          values['pick_three'] is! int ||
          values['pick_three_enabled'] is! bool ||
          values['general_market'] is! int ||
          values['penalty_stacking'] is! bool) {
        throw const FormatException('The server returned invalid game rules');
      }
      if (mounted) setState(() => rules.addAll(values));
    } catch (e) {
      if (mounted) {
        setState(() {
          error = 'Could not load game-rule defaults: $e';
        });
      }
    }
  }

  Future<void> connect(String action) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('name', name.text);
      await channel?.sink.close();
      final socket = WebSocketChannel.connect(Uri.parse(webSocketUrl));
      await socket.ready;
      channel = socket;
      socket.stream.listen((event) async {
        final msg = jsonDecode(event as String) as Map<String, dynamic>;
        if (!mounted) return;
        if (msg['type'] == 'session') {
          pid = msg['player_id'] as String;
          code = msg['code'] as String;
          reconnectToken = msg['reconnect_token'] as String;
          await prefs.setString('pid', pid!);
          await prefs.setString('code', code!);
          await prefs.setString('reconnect_token', reconnectToken!);
        }
        setState(() {
          busy = false;
          if (msg['type'] == 'state') {
            state = Map<String, dynamic>.from(msg['data'] as Map);
          }
          if (msg['type'] == 'error') error = msg['message'] as String?;
        });
      }, onError: (Object e) {
        if (mounted) {
          setState(() {
            error = '$e';
            busy = false;
          });
        }
      }, onDone: () {
        if (mounted) {
          setState(() {
            error = 'Disconnected. Tap Reconnect.';
            busy = false;
          });
        }
      });
      send({
        'action': action,
        'name': name.text.trim().isEmpty ? 'Guest' : name.text.trim(),
        if (action == 'create') 'team_mode': teamMode,
        if (action == 'create' || action == 'quick_match') 'rules': rules,
        if (accessToken != null) 'access_token': accessToken,
        if (action == 'join') 'code': roomCode.text.trim(),
        if (action == 'reconnect') 'code': code,
        if (action == 'reconnect') 'player_id': pid,
        if (action == 'reconnect') 'reconnect_token': reconnectToken,
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          error = 'Connection failed: $e';
          busy = false;
        });
      }
    }
  }

  void send(Map<String, dynamic> message) =>
      channel?.sink.add(jsonEncode(message));

  Uri apiUri(String path) {
    return Uri.parse('$apiBaseUrl$path');
  }

  Widget ruleDropdown(String key, String label, int min, int max) =>
      DropdownButtonFormField<int>(
        initialValue: rules[key] as int,
        decoration: InputDecoration(labelText: label),
        items: [
          for (var value = min; value <= max; value++)
            DropdownMenuItem(value: value, child: Text('$value')),
        ],
        onChanged:
            busy || (key == 'pick_three' && rules['pick_three_enabled'] != true)
                ? null
                : (value) {
                    if (value != null) setState(() => rules[key] = value);
                  },
      );

  Future<void> authenticate(
      bool registering, Map<String, String> values) async {
    if (!mounted) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final response = await http.post(
          apiUri(registering ? '/api/auth/register' : '/api/auth/login'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode(values));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw Exception(body['detail'] ?? 'Authentication failed');
      }
      accessToken = body['access_token'] as String;
      final user = Map<String, dynamic>.from(body['user'] as Map);
      name.text = user['username'] as String;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', accessToken!);
      await prefs.setString('name', name.text);
      authPassword.clear();
      if (mounted) {
        setState(() {
          busy = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          error = '$e';
        });
      }
    }
  }

  Future<void> showAccountData(bool leaderboard) async {
    try {
      final response = await http.get(
          apiUri(leaderboard ? '/api/leaderboard' : '/api/profile'),
          headers: {
            if (!leaderboard && accessToken != null)
              'authorization': 'Bearer $accessToken'
          });
      if (response.statusCode >= 400) {
        throw Exception('Request failed (${response.statusCode})');
      }
      final decoded = jsonDecode(response.body);
      if (!mounted) return;
      final text = leaderboard
          ? (decoded as List).asMap().entries.map((entry) {
              final player = entry.value as Map<String, dynamic>;
              return '${entry.key + 1}. ${player['username']} — ${player['wins']} wins';
            }).join('\n')
          : (() {
              final user = decoded as Map<String, dynamic>;
              return '${user['username']}\n${user['wins']} wins • ${user['matches_played']} matches';
            })();
      await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
                title: Text(leaderboard ? 'Leaderboard' : 'Player profile'),
                content: Text(text.isEmpty ? 'No ranked players yet.' : text),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Close'))
                ],
              ));
    } catch (e) {
      if (mounted) {
        setState(() {
          error = '$e';
        });
      }
    }
  }

  Future<void> signOut() async {
    await channel?.sink.close();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('access_token');
    if (!mounted) return;
    setState(() {
      accessToken = null;
      state = null;
      pid = null;
      code = null;
      reconnectToken = null;
    });
  }

  Widget authScreen() => Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: AutofillGroup(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const ArenaLogo(size: 92, showWordmark: true),
                        const SizedBox(height: 34),
                        Text(
                            registering
                                ? 'Create your player account'
                                : 'Welcome back',
                            textAlign: TextAlign.center,
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        Text(
                            registering
                                ? 'Your profile, wins and matches sync with WHOT Arena on the web.'
                                : 'Sign in with the same account you use on the web app.',
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white60)),
                        const SizedBox(height: 28),
                        if (error != null)
                          Card(
                              color: Colors.red.shade900,
                              child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Text(error!))),
                        if (registering)
                          TextField(
                              controller: authUsername,
                              textInputAction: TextInputAction.next,
                              autofillHints: const [AutofillHints.newUsername],
                              decoration: const InputDecoration(
                                  labelText: 'Player name',
                                  prefixIcon: Icon(Icons.person_outline))),
                        if (registering) const SizedBox(height: 14),
                        TextField(
                            controller: authEmail,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email],
                            decoration: const InputDecoration(
                                labelText: 'Email address',
                                prefixIcon: Icon(Icons.mail_outline))),
                        const SizedBox(height: 14),
                        TextField(
                            controller: authPassword,
                            obscureText: obscurePassword,
                            textInputAction: TextInputAction.done,
                            autofillHints: [
                              registering
                                  ? AutofillHints.newPassword
                                  : AutofillHints.password
                            ],
                            onSubmitted: (_) => submitAuth(),
                            decoration: InputDecoration(
                                labelText: 'Password',
                                helperText: registering
                                    ? 'At least 8 characters'
                                    : null,
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                    onPressed: () => setState(() =>
                                        obscurePassword = !obscurePassword),
                                    icon: Icon(obscurePassword
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined)))),
                        const SizedBox(height: 22),
                        button(
                            busy
                                ? 'PLEASE WAIT…'
                                : registering
                                    ? 'CREATE ACCOUNT'
                                    : 'SIGN IN',
                            busy ? null : submitAuth),
                        TextButton(
                            onPressed: busy
                                ? null
                                : () => setState(() {
                                      registering = !registering;
                                      error = null;
                                    }),
                            child: Text(registering
                                ? 'Already have an account? Sign in'
                                : 'New to the Arena? Create an account')),
                      ]),
                ),
              ),
            ),
          ),
        ),
      );

  void submitAuth() {
    final email = authEmail.text.trim();
    final password = authPassword.text;
    final username = authUsername.text.trim();
    if (!email.contains('@') ||
        password.isEmpty ||
        (registering && (username.length < 3 || password.length < 8))) {
      setState(() => error = registering
          ? 'Enter a valid email, a 3–24 character player name, and an 8+ character password.'
          : 'Enter your email address and password.');
      return;
    }
    authenticate(registering, {
      'email': email,
      'password': password,
      if (registering) 'username': username,
    });
  }

  @override
  void dispose() {
    channel?.sink.close();
    name.dispose();
    roomCode.dispose();
    authEmail.dispose();
    authPassword.dispose();
    authUsername.dispose();
    super.dispose();
  }

  Widget button(String label, VoidCallback? onTap, {bool accent = true}) =>
      Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton(
              onPressed: onTap,
              style: FilledButton.styleFrom(
                  backgroundColor: accent ? green : const Color(0xFF245044),
                  foregroundColor: accent ? Colors.black : Colors.white),
              child: Text(label,
                  style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          ));

  @override
  Widget build(BuildContext context) {
    if (initializing) return const ArenaSplash();
    if (accessToken == null) return authScreen();
    final data = state;
    return Scaffold(
      appBar: AppBar(
          title: const Text('🃏 WHOT ARENA'),
          backgroundColor: bg,
          actions: [
            if (data != null)
              IconButton(
                  onPressed: () => setState(() {
                        state = null;
                      }),
                  icon: const Icon(Icons.home))
          ]),
      body: SafeArea(
          child: Center(
              child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 650),
        child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (error != null)
                  Card(
                      color: Colors.red.shade900,
                      child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(error!))),
                if (data == null) ...[
                  const Icon(Icons.style, size: 100, color: gold),
                  const SizedBox(height: 10),
                  const Text('PLAY • COMPETE • BECOME A LEGEND',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: gold)),
                  const SizedBox(height: 28),
                  TextField(
                      controller: name,
                      maxLength: 20,
                      decoration: const InputDecoration(labelText: 'Nickname')),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('2v2 TEAM MATCH'),
                    subtitle:
                        const Text('Four players · seats 1 & 3 vs seats 2 & 4'),
                    value: teamMode,
                    onChanged: (value) => setState(() => teamMode = value),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 10),
                    child: Text('GAME RULES',
                        style: TextStyle(
                            color: gold, fontWeight: FontWeight.bold)),
                  ),
                  ruleDropdown('cards_per_player', 'Cards per player', 3, 10),
                  ruleDropdown('pick_two', 'Pick Two penalty cards', 1, 10),
                  ruleDropdown('pick_three', 'Pick Three penalty cards', 1, 10),
                  ruleDropdown('general_market', 'General Market cards', 1, 5),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('ENABLE PICK THREE'),
                    value: rules['pick_three_enabled'] as bool,
                    onChanged: busy
                        ? null
                        : (value) =>
                            setState(() => rules['pick_three_enabled'] = value),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('ALLOW PENALTY STACKING'),
                    value: rules['penalty_stacking'] as bool,
                    onChanged: busy
                        ? null
                        : (value) =>
                            setState(() => rules['penalty_stacking'] = value),
                  ),
                  Row(children: [
                    Expanded(
                        child: OutlinedButton.icon(
                            onPressed: busy ? null : signOut,
                            icon: const Icon(Icons.logout),
                            label: const Text('SIGN OUT'))),
                  ]),
                  if (accessToken != null)
                    Row(children: [
                      Expanded(
                          child: TextButton(
                              onPressed: () => showAccountData(false),
                              child: const Text('PROFILE'))),
                      Expanded(
                          child: TextButton(
                              onPressed: () => showAccountData(true),
                              child: const Text('LEADERBOARD'))),
                    ]),
                  button('CREATE PRIVATE ROOM',
                      busy ? null : () => connect('create')),
                  button('QUICK MATCH',
                      busy ? null : () => connect('quick_match')),
                  TextField(
                      controller: roomCode,
                      decoration:
                          const InputDecoration(labelText: 'Room code')),
                  button('JOIN ROOM', busy ? null : () => connect('join'),
                      accent: false),
                  if (pid != null && code != null && reconnectToken != null)
                    button('RECONNECT TO $code',
                        busy ? null : () => connect('reconnect'),
                        accent: false),
                  const SizedBox(height: 14),
                  const Text(
                      'Guest play is available now. Registered accounts, '
                      'public matchmaking and rankings are available with the Arena server.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white60)),
                ] else ...[
                  Text('ROOM ${data['code']}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.bold,
                          color: gold)),
                  const SizedBox(height: 10),
                  ...((data['players'] as List).map((p) => ListTile(
                        leading: Icon(
                            p['connected'] == true
                                ? Icons.circle
                                : Icons.circle_outlined,
                            color:
                                p['connected'] == true ? green : Colors.grey),
                        title: Text(
                            '${p['name']}${p['id'] == pid ? ' (You)' : ''}'
                            '${data['team_mode'] == true ? ' · TEAM ${p['team']}' : ''}'),
                        trailing: Text(data['status'] == 'lobby'
                            ? (p['connected'] == true ? 'READY' : 'AWAY')
                            : '${p['count']} cards'),
                      ))),
                  if (data['status'] == 'lobby') ...[
                    Text(
                        data['team_mode'] == true
                            ? '2v2 team match: seats 1 & 3 vs seats 2 & 4. Invite four players.'
                            : 'Share this room code with friends (2–4 players).',
                        textAlign: TextAlign.center),
                    if (data['host'] == pid)
                      button(
                          data['team_mode'] == true &&
                                  (data['players'] as List).length != 4
                              ? 'WAITING FOR 4 PLAYERS'
                              : 'START MATCH',
                          (data['team_mode'] == true
                                  ? (data['players'] as List).length == 4
                                  : (data['players'] as List).length >= 2)
                              ? () => send({'action': 'start'})
                              : null),
                  ],
                  if (data['status'] == 'playing') gameView(data),
                  if (data['status'] == 'finished') ...[
                    const SizedBox(height: 24),
                    Text(
                        data['team_mode'] == true
                            ? (((data['players'] as List).firstWhere(
                                        (p) => p['id'] == pid)['team']) ==
                                    ((data['players'] as List).firstWhere((p) =>
                                        p['id'] == data['winner'])['team'])
                                ? '🏆 YOUR TEAM WON!'
                                : '🏁 MATCH FINISHED')
                            : data['winner'] == pid
                                ? '🏆 YOU WON!'
                                : '🏁 MATCH FINISHED',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 28, color: gold)),
                  ],
                ],
              ],
            )),
      ))),
    );
  }

  Widget gameView(Map<String, dynamic> data) {
    final top = Map<String, dynamic>.from(data['top'] as Map);
    final myTurn = data['turn'] == pid;
    final hand = data['hand'] as List;
    return Column(children: [
      const SizedBox(height: 18),
      if (data['team_mode'] == true)
        Text(
            '2v2 · You are on Team ${((data['players'] as List).firstWhere((p) => p['id'] == pid)['team'])}',
            style: const TextStyle(color: gold, fontWeight: FontWeight.bold)),
      if (data['team_mode'] == true) const SizedBox(height: 8),
      Text(data['last_action'] ?? '', textAlign: TextAlign.center),
      const SizedBox(height: 14),
      const Text('DISCARD PILE', style: TextStyle(color: gold)),
      cardView(top, selected: true),
      if (data['requested_shape'] != null)
        Text('REQUESTED: ${data['requested_shape']}'.toUpperCase(),
            style: const TextStyle(color: gold)),
      const SizedBox(height: 20),
      Text(myTurn ? '🟢 YOUR TURN' : 'Waiting for opponent...',
          style:
              TextStyle(color: myTurn ? green : Colors.white70, fontSize: 18)),
      const SizedBox(height: 14),
      Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.center,
          children: hand.map((c) {
            final card = Map<String, dynamic>.from(c as Map);
            return InkWell(
              onTap: myTurn
                  ? () async {
                      if (card['number'] == 20) {
                        final shape = await showDialog<String>(
                            context: context,
                            builder: (context) => SimpleDialog(
                                title: const Text('Request a shape'),
                                children: [
                                  'circle',
                                  'triangle',
                                  'cross',
                                  'square',
                                  'star'
                                ]
                                    .map((s) => SimpleDialogOption(
                                        onPressed: () =>
                                            Navigator.pop(context, s),
                                        child: Text(s.toUpperCase())))
                                    .toList()));
                        if (shape != null) {
                          send({
                            'action': 'play',
                            'card_id': card['id'],
                            'shape': shape
                          });
                        }
                      } else {
                        send({'action': 'play', 'card_id': card['id']});
                      }
                    }
                  : null,
              child: cardView(card),
            );
          }).toList()),
      const SizedBox(height: 20),
      button(
          'DRAW CARD & PASS', myTurn ? () => send({'action': 'draw'}) : null),
    ]);
  }

  Widget cardView(Map<String, dynamic> card, {bool selected = false}) {
    final isWhot = card['shape'] == 'whot';
    final cardWidth = selected ? 105.0 : 73.0;
    final cornerFontSize = cardWidth * 0.1613;
    final cornerInset = cardWidth * 0.0968;
    const icons = {
      'circle': '●',
      'triangle': '▲',
      'cross': '✚',
      'square': '■',
      'star': '★',
      'whot': 'W'
    };
    return Container(
      width: cardWidth,
      height: selected ? 140 : 102,
      margin: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        color: isWhot ? const Color(0xFFF3E8D6) : Colors.white,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(
            color: isWhot ? const Color(0xFFD6C1A2) : gold, width: 2),
        boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6)],
      ),
      child: isWhot
          ? Stack(
              children: [
                Positioned(
                  top: cornerInset,
                  left: cornerInset,
                  child: Text(
                    '${card['number']}',
                    style: TextStyle(
                      fontSize: cornerFontSize,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF612B32),
                    ),
                  ),
                ),
                Center(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      'WHOT',
                      style: TextStyle(
                        fontSize: cardWidth * 12 / 73,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                        color: Color(0xFF612B32),
                      ),
                    ),
                  ),
                ),
                Positioned(
                  right: cornerInset,
                  bottom: cornerInset,
                  child: Transform.rotate(
                    angle: 3.141592653589793,
                    child: Text(
                      '${card['number']}',
                      style: TextStyle(
                        fontSize: cornerFontSize,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF612B32),
                      ),
                    ),
                  ),
                ),
              ],
            )
          : Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('${card['number']}',
                  style: const TextStyle(
                      fontSize: 25,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1049A0))),
              Text(icons[card['shape']] ?? '?',
                  style:
                      const TextStyle(fontSize: 28, color: Color(0xFF1049A0))),
            ]),
    );
  }
}

class ArenaLogo extends StatelessWidget {
  const ArenaLogo({super.key, this.size = 64, this.showWordmark = false});
  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) =>
      Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: size * .72,
          height: size,
          decoration: BoxDecoration(
              color: const Color(0xFFF5F0E6),
              border: Border.all(color: gold, width: 3),
              borderRadius: BorderRadius.circular(size * .12),
              boxShadow: const [
                BoxShadow(color: Colors.black38, blurRadius: 18)
              ]),
          transform: Matrix4.rotationZ(-.09),
          alignment: Alignment.center,
          child: Text('W',
              style: TextStyle(
                  color: const Color(0xFF174C35),
                  fontSize: size * .48,
                  fontWeight: FontWeight.w900)),
        ),
        if (showWordmark) ...[
          const SizedBox(height: 16),
          Text('WHOT ARENA',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: size * .22,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2.5)),
        ]
      ]);
}

class ArenaSplash extends StatelessWidget {
  const ArenaSplash({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          ArenaLogo(size: 118, showWordmark: true),
          SizedBox(height: 34),
          SizedBox(
              width: 150,
              child: LinearProgressIndicator(
                  minHeight: 3,
                  color: gold,
                  backgroundColor: Color(0xFF245044))),
          SizedBox(height: 14),
          Text('SETTING THE TABLE',
              style: TextStyle(
                  color: Colors.white54, fontSize: 11, letterSpacing: 2)),
        ])),
      );
}
