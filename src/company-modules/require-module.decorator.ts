import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

/**
 * Marks a controller (or route) as belonging to an add-on module. Use together
 * with ModuleGuard: requests from companies that have not connected the module
 * get 403 MODULE_NOT_ENABLED, even if the user's token still carries the
 * module's permissions.
 */
export const RequireModule = (moduleKey: string) => SetMetadata(REQUIRE_MODULE_KEY, moduleKey);
