export interface JwtPayload {
  sub: string; // User ID
  username: string;
  role?: string;
  iat?: number;
  exp?: number;
}
