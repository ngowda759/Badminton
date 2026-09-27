/**
 * Raised when environment configuration fails validation.
 *
 * The message intentionally contains variable *names* and constraint
 * descriptions only - never the offending values, which may be secrets.
 */
export class ConfigurationError extends Error {
  public override readonly name = 'ConfigurationError';

  public constructor(message: string) {
    super(message);
  }
}
