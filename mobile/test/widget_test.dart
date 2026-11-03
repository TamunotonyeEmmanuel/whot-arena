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
  testWidgets('renders guest home actions', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const ArenaApp());
    await tester.pumpAndSettle();
    expect(find.text('CREATE PRIVATE ROOM'), findsOneWidget);
    expect(find.text('2v2 TEAM MATCH'), findsOneWidget);
    expect(find.text('GAME RULES'), findsOneWidget);
    expect(find.text('ENABLE PICK THREE'), findsOneWidget);
    expect(find.text('ALLOW PENALTY STACKING'), findsOneWidget);
    expect(find.text('QUICK MATCH'), findsOneWidget);
    expect(find.text('JOIN ROOM'), findsOneWidget);
  });
}
