import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { CompanyRolesService } from './company-roles.service';
import { PlatformGuard } from './platform.guard';
import { TenantOnboardingService } from './tenant-onboarding.service';

// Global: sign-in, sign-up, the team / roles screens and the platform console
// all ask "who is this and what may they do" the same way.
@Global()
@Module({
  providers: [AccessService, CompanyRolesService, PlatformGuard, TenantOnboardingService],
  exports: [AccessService, CompanyRolesService, PlatformGuard, TenantOnboardingService],
})
export class AccessModule {}
