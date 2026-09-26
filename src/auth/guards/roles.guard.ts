import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type UserRole = 'user' | 'teacher' | 'admin' | 'invitado';

export const ROLES_KEY = 'roles';

/** Restricts a route (or a whole controller) to the listed roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Enforces @Roles(). Must run after AuthGuard, which puts the verified token
 * payload on request.user.
 *
 * The token only carries { id, email }, so the role is read from the database
 * on every guarded request. That is deliberate: a role baked into a 30-day
 * token would keep a demoted admin an admin until it expired. Reading it here
 * also rejects tokens whose user has since been deleted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest();
    const id = request.user?.id;
    if (!id) throw new UnauthorizedException();

    const user = await this.dataSource.getRepository(User).findOne({
      where: { id },
      select: { id: true, role: true },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    request.user.role = user.role;
    if (!roles.includes(user.role as UserRole)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
