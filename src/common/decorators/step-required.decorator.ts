import { SetMetadata } from '@nestjs/common';
import { OnboardingStep } from '../enums';

export const STEP_REQUIRED_KEY = 'step_required';

export const StepRequired = (step: OnboardingStep) => SetMetadata(STEP_REQUIRED_KEY, step);
