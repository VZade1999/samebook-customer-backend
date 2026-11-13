import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import  cors from 'cors';
import { Logger } from '@nestjs/common';
import  cookieParser from 'cookie-parser';
import { json } from 'express';
import { ConstantsService } from './Util/constants.service';
import { AuthGuard } from './middlewares/auth.guard';
import { assertJwtSecrets } from './auth/jwt.util';

const PORT = process.env.PORT || 3030;

async function bootstrap() {
  // .env.local is loaded by now (ConfigModule ran while AppModule was
  // imported). Resolve the JWT secrets up front so a missing secret fails the
  // boot in production instead of the first login.
  assertJwtSecrets();

  const app = await NestFactory.create(AppModule);

  // Default body-parser limit (100kb) is too small for a base64-encoded
  // document photo/PDF (the AI agent's document-upload feature) — raised
  // globally rather than per-route since Nest doesn't cleanly support a
  // per-route override on top of its default body parsing.
  app.use(json({ limit: '15mb' }));

  const appCors: cors.CorsOptions = {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://samebook-frontend-dev.vercel.app',           // ✅ production (no trailing slash)
      'https://samebook-frontend-dev-git-main-vzade1999s-projects.vercel.app', // ✅ no trailing slash
      'https://samebook-frontend-7509vwpkg-vzade1999s-projects.vercel.app',
    ],
    allowedHeaders: ConstantsService.CORS.ALLOWED_HEADERS,
    exposedHeaders: ConstantsService.CORS.EXPOSED_HEADERS,
    methods: ConstantsService.CORS.METHODS,
    credentials: true,
  };
  // CRM lead intake is public: customers' website forms on any domain post
  // leads to it. No cookies are involved, so any origin is fine there.
  const intakeCors: cors.CorsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false,
    maxAge: 86400,
  };
  app.use(
    cors((req: any, cb: (err: Error | null, options?: cors.CorsOptions) => void) =>
      cb(null, /\/crm\/intake\//.test(String(req.originalUrl || req.url || '')) ? intakeCors : appCors),
    ),
  );

  app.use(cookieParser());

  // app.useGlobalGuards(new AuthGuard());

  app.use(
    helmet({
      strictTransportSecurity: {
        includeSubDomains: false,
        maxAge: 31536000,
      },
    }),
  );

  // set API prefix same as ALB Ingress path based routing
  Logger.log(`[API Prefix] - ${process.env.API_PREFIX}`);
  if (process.env.API_PREFIX) {
    app.setGlobalPrefix(process.env.API_PREFIX);
  }
  await app.listen(PORT);
}
bootstrap();
