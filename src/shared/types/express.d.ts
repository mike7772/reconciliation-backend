export interface CurrentUser {
  id: string;
  email: string;
  role: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: CurrentUser;
    }
  }
}
