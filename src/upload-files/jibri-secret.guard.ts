import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Authenticates the Jibri finalize/retry scripts, which run on the Jitsi host
 * with no user session, by a shared secret in the `X-Jibri-Secret` header.
 *
 * A guard rather than a check in the handler so a rejected request is refused
 * before multer writes the upload to disk.
 *
 * Fails closed: with JIBRI_UPLOAD_SECRET unset nothing is accepted. The
 * scripts keep a failed recording on disk and retry every 15 minutes, so
 * nothing is lost while the secret is being configured on both sides.
 */
@Injectable()
export class JibriSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.JIBRI_UPLOAD_SECRET;
    const provided = context.switchToHttp().getRequest().headers['x-jibri-secret'];
    if (!expected || typeof provided !== 'string') {
      throw new UnauthorizedException();
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
