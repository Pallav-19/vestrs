import { ForbiddenException } from '@nestjs/common';

export function assertNonProd(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new ForbiddenException('Dev endpoints are not available in production');
  }
}
