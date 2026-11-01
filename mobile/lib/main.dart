import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

const bg = Color(0xFF071C16);
const green = Color(0xFF00C896);
const gold = Color(0xFFFFD166);

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
  final server = TextEditingController(text: 'ws://10.0.2.2:8000/ws');
  WebSocketChannel? channel;
  Map<String, dynamic>? state;
  String? pid, code, reconnectToken, accessToken, error;
  bool busy = false;
  bool teamMode = false;

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
      server.text = prefs.getString('server') ?? 'ws://10.0.2.2:8000/ws';
      pid = prefs.getString('pid');
      code = prefs.getString('code');
      reconnectToken = prefs.getString('reconnect_token');
      accessToken = prefs.getString('access_token');
    });
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
      await prefs.setString('server', server.text);
      await channel?.sink.close();
      final socket = WebSocketChannel.connect(Uri.parse(server.text.trim()));
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
          if (msg['type'] == 'state')
            state = Map<String, dynamic>.from(msg['data'] as Map);
          if (msg['type'] == 'error') error = msg['message'] as String?;
        });
      }, onError: (Object e) {
        if (mounted)
          setState(() {
            error = '$e';
            busy = false;
          });
      }, onDone: () {
        if (mounted)
          setState(() {
            error = 'Disconnected. Tap Reconnect.';
            busy = false;
          });
      });
      send({
        'action': action,
        'name': name.text.trim().isEmpty ? 'Guest' : name.text.trim(),
        if (action == 'create') 'team_mode': teamMode,
        if (accessToken != null) 'access_token': accessToken,
        if (action == 'join') 'code': roomCode.text.trim(),
        if (action == 'reconnect') 'code': code,
        if (action == 'reconnect') 'player_id': pid,
        if (action == 'reconnect') 'reconnect_token': reconnectToken,
      });
    } catch (e) {
      if (mounted)
        setState(() {
          error = 'Connection failed: $e';
          busy = false;
        });
    }
  }

  void send(Map<String, dynamic> message) =>
      channel?.sink.add(jsonEncode(message));

  Uri apiUri(String path) {
    final ws = Uri.parse(server.text.trim());
    return ws.replace(
        scheme: ws.scheme == 'wss' ? 'https' : 'http', path: path);
  }

  Future<void> authenticate(bool registering) async {
    final email = TextEditingController();
    final password = TextEditingController();
    final username = TextEditingController();
    final values = await showDialog<Map<String, String>>(
        context: context,
        builder: (context) => AlertDialog(
              title: Text(registering ? 'Create account' : 'Sign in'),
              content: SingleChildScrollView(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (registering)
                  TextField(
                      controller: username,
                      decoration: const InputDecoration(labelText: 'Username')),
                TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email')),
                TextField(
                    controller: password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password')),
              ])),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, {
                          'email': email.text.trim(),
                          'password': password.text,
                          if (registering) 'username': username.text.trim(),
                        }),
                    child: Text(registering ? 'Register' : 'Sign in')),
              ],
            ));
    email.dispose();
    password.dispose();
    username.dispose();
    if (values == null || !mounted) return;
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
      if (response.statusCode >= 400)
        throw Exception(body['detail'] ?? 'Authentication failed');
      accessToken = body['access_token'] as String;
      final user = Map<String, dynamic>.from(body['user'] as Map);
      name.text = user['username'] as String;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', accessToken!);
      await prefs.setString('name', name.text);
      if (mounted)
        setState(() {
          busy = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          busy = false;
          error = '$e';
        });
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
      if (response.statusCode >= 400)
        throw Exception('Request failed (${response.statusCode})');
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
      if (mounted)
        setState(() {
          error = '$e';
        });
    }
  }

  @override
  void dispose() {
    channel?.sink.close();
    name.dispose();
    roomCode.dispose();
    server.dispose();
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
                  TextField(
                      controller: server,
                      decoration: const InputDecoration(
                          labelText: 'Server WebSocket URL')),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('2v2 TEAM MATCH'),
                    subtitle:
                        const Text('Four players · seats 1 & 3 vs seats 2 & 4'),
                    value: teamMode,
                    onChanged: (value) => setState(() => teamMode = value),
                  ),
                  Row(children: [
                    Expanded(
                        child: OutlinedButton(
                            onPressed: busy ? null : () => authenticate(false),
                            child: const Text('SIGN IN'))),
                    const SizedBox(width: 10),
                    Expanded(
                        child: OutlinedButton(
                            onPressed: busy ? null : () => authenticate(true),
                            child: const Text('REGISTER'))),
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
                        if (shape != null)
                          send({
                            'action': 'play',
                            'card_id': card['id'],
                            'shape': shape
                          });
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
    const icons = {
      'circle': '●',
      'triangle': '▲',
      'cross': '✚',
      'square': '■',
      'star': '★',
      'whot': 'W'
    };
    return Container(
      width: selected ? 105 : 73,
      height: selected ? 140 : 102,
      margin: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: gold, width: 2),
        boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6)],
      ),
      child: card['shape'] == 'whot'
          ? Stack(
              children: [
                Positioned(
                  top: 7,
                  left: 8,
                  child: Text(
                    '${card['number']}',
                    style: const TextStyle(
                      fontSize: 25,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1049A0),
                    ),
                  ),
                ),
                Center(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      'WHOT',
                      style: const TextStyle(
                        fontSize: 25,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                        color: Color(0xFF1049A0),
                      ),
                    ),
                  ),
                ),
                Positioned(
                  right: 8,
                  bottom: 7,
                  child: Text(
                    '${card['number']}',
                    style: const TextStyle(
                      fontSize: 25,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1049A0),
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
