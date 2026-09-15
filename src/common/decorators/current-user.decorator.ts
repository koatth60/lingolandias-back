import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Identity as proven by the JWT, put on the request by AuthGuard.
 *
 * `id` is the only field any caller should use to decide "who is doing this" —
 * the shape mirrors what auth.service signs ({ email, id }).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * Reads the authenticated user off the request.
 *
 * Exists because every route in this codebase used to take the acting user's
 * id from a query param or request body, which meant any logged-in user could
 * act as any other simply by sending a different id. AuthGuard was already
 * populating request.user; nothing read it. Routes should take their actor
 * from here and treat a client-supplied user id as, at most, the *target* of
 * an action that still has to be authorised against this value.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    return data ? user?.[data] : user;
  },
);
