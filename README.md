# 👻 GhostLink

**GhostLink** — это безопасный файлообменник с архитектурой Zero-Knowledge (нулевое разглашение). Файлы шифруются в браузере перед отправкой, сервер никогда не видит ключи шифрования.

![GhostLink Preview](./public/screenshot.png)

## 🚀 Возможности

- **🔒 Zero-Knowledge Encryption:** Шифрование AES-256-GCM на клиенте. Ключ передается через URL hash и не уходит на сервер.
- **📁 Chunk Upload:** Поддержка больших файлов (загрузка чанками по 5 МБ).
- **⏱ Настройки жизни:** Удаление после 1 скачивания (Burn) или через 24 часа (TTL).
- **🛡 Дополнительная защита:** Возможность установить пароль (PBKDF2) поверх ссылки.
- **📱 QR-код:** Быстрая передача ссылки на мобильные устройства.
- **🚦 Rate Limiting:** Защита от спама через Server Actions (не более 5 файлов в час).

## 🛠 Технический стек

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS
- **Backend/DB:** Supabase (PostgreSQL, Storage, Edge Functions/Cron)
- **Cryptography:** Web Crypto API (Native Browser API)

## 📦 Установка и запуск

1. **Клонировать репозиторий:**
   ```bash
   git clone [https://github.com/DTside/ghost-link.git](https://github.com/DTside/ghost-link.git)