import type { AuthProvider, AuthenticatedUser } from "./types.js";
import { AppError } from "../errors/api-errors.js";

const DEV_USER: AuthenticatedUser = {
  externalId: "dev-user-001",
  email: "dev@datakitchen.local",
  displayName: "Development User",
  rawClaims: {},
};

export class DevAuthProvider implements AuthProvider {
  private readonly expectedToken: string;

  constructor(expectedToken: string) {
    this.expectedToken = expectedToken;
  }

  async validateToken(token: string): Promise<AuthenticatedUser> {
    if (!token || token !== this.expectedToken) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid development token");
    }
    return DEV_USER;
  }
}
