import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OnboardingStep } from '../enums';
import { STEP_REQUIRED_KEY } from '../decorators/step-required.decorator';

@Injectable()
export class OnboardingStepGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OnboardingStep>(STEP_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();

    if (user?.onboardingStep !== required) {
      throw new ForbiddenException({
        code: 'STEP_NOT_ALLOWED',
        message: `Requires onboarding step: ${required}. Current: ${user?.onboardingStep}`,
      });
    }

    return true;
  }
}
