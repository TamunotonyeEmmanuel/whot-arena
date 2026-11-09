// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:whot_arena/main.dart';

void main() {
  testWidgets('renders account sign-in and registration',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const ArenaApp());
    await tester.pumpAndSettle();
    expect(find.text('WHOT ARENA'), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('SIGN IN'), findsOneWidget);

    final registerLink = find.text('New to the Arena? Create an account');
    await tester.ensureVisible(registerLink);
    await tester.tap(registerLink);
    await tester.pump();
    expect(find.text('Create your player account'), findsOneWidget);
    expect(find.text('Player name'), findsOneWidget);
    expect(find.text('CREATE ACCOUNT'), findsOneWidget);
  });
}
