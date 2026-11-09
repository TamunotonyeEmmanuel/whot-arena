# WHOT Arena mobile

Flutter client for the same FastAPI service and account database used by the
WHOT Arena web app.

The API and socket endpoints are build-time configuration, not fields exposed
to players:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://your-api.example.com
```

For the Android emulator the development API defaults to
`http://10.0.2.2:8000`. The socket endpoint is derived automatically from the
API address, so players never need to enter or manage a WebSocket URL.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
