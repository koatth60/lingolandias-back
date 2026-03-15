# Lingolandias Academy — Backend

REST API and WebSocket server powering [lingolandias.com](https://lingolandias.com) — a live language learning platform with 500+ active users, one-on-one class scheduling, and real-time chat.

---

## Overview

Lingolandias Academy supports three user roles: **Admin**, **Teacher**, and **Student**. The backend handles authentication, role-based access control, class booking and calendar management, and real-time communication via WebSockets.

---

## Features

- **Role-based authentication** — JWT with three roles: admin, teacher, student
- **Class scheduling** — teachers set availability, students book one-on-one sessions via calendar
- **Real-time chat** — Socket.IO gateway for live in-class messaging
- **Admin panel API** — full user and platform management
- **Production deployment** — live and actively maintained at lingolandias.com

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL |
| Real-time | Socket.IO |
| Auth | JWT |
| ORM | TypeORM |

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm

### Installation

```bash
git clone https://github.com/koatth60/lingolandias-back.git
cd lingolandias-back
npm install
cp .env.example .env
npm run migration:run
npm run start:dev
```

### Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/lingolandias
JWT_SECRET=your_jwt_secret
PORT=3000
```

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register as student or teacher |
| POST | `/auth/login` | Login and receive JWT |
| GET | `/classes` | List available classes |
| POST | `/classes` | Create a class (teacher) |
| POST | `/classes/:id/book` | Book a class (student) |
| GET | `/availability` | Get teacher availability slots |
| POST | `/availability` | Set availability (teacher) |
| GET | `/users` | List users (admin) |
| GET | `/users/:id` | Get user profile |

---

## WebSocket Events

| Event | Direction | Description |
|---|---|---|
| `join_room` | Client → Server | Join a class chat room |
| `message` | Client → Server | Send a message |
| `message` | Server → Client | Receive a message |
| `user_joined` | Server → Client | User joined notification |

---

## Project Structure

```
src/
├── auth/             # JWT authentication and guards
├── classes/          # Class scheduling and booking
├── chat/             # Socket.IO real-time chat gateway
├── users/            # User profiles (student, teacher, admin)
├── availability/     # Teacher availability management
└── common/           # Shared pipes, guards, and utilities
```

---

## Live App

[lingolandias.com](https://lingolandias.com)

---

## Related

- [lingolandias-front](https://github.com/koatth60/lingolandias-front) — React frontend

---

## License

MIT
