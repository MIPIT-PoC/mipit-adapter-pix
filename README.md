# mipit-adapter-pix

MiPIT PoC — PIX rail adapter (consumer/worker).

Consumes canonical payment messages from RabbitMQ, translates them to PIX payload format, calls the sandbox/mock PIX endpoint, handles retries with exponential backoff, normalizes the response, and publishes the acknowledgment back to the core.

## Flow

```
Core → RabbitMQ (payments.route.pix) → adapter-pix → sandbox/mock PIX → ack → RabbitMQ (ack.pix) → Core
```

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev      # Start worker with hot reload
npm run mock     # Start mock PIX sandbox on port 9001
```

## Scripts

| Script          | Description                        |
|-----------------|------------------------------------|
| `npm run dev`   | Start worker with tsx watch        |
| `npm run build` | Compile TypeScript                 |
| `npm start`     | Run compiled worker                |
| `npm run mock`  | Start embedded PIX mock sandbox    |
| `npm run lint`  | Run ESLint                         |
| `npm run format`| Format with Prettier               |
| `npm test`      | Run Jest tests                     |

## Environment Variables

See [`.env.example`](.env.example) for all required configuration.

## Docker

```bash
docker build -t mipit-adapter-pix .
docker run --env-file .env mipit-adapter-pix
```
