import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as authRepository from "./auth.repository";
import { RegisterInput, LoginInput } from "./auth.validation";
import ApiError from "../../shared/errors/ApiError";
import httpStatusCodes from "../../shared/constants/httpStatusCodes";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

function signToken(user: { id: string; email: string }) {
  const token = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );
  return { token, user: { id: user.id, email: user.email } };
}

export async function register(input: RegisterInput) {
  const existing = await authRepository.findByEmail(input.email);
  if (existing) {
    throw new ApiError(httpStatusCodes.CONFLICT, "Email is already registered");
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);
  const user = await authRepository.createUser({
    name: input.name,
    email: input.email,
    password: hashedPassword,
  });

  return signToken(user);
}

export async function login(input: LoginInput) {
  const user = await authRepository.findByEmail(input.email);
  if (!user) {
    throw new ApiError(httpStatusCodes.UNAUTHORIZED, "Invalid email or password");
  }

  const isValidPassword = await bcrypt.compare(input.password, user.password);
  if (!isValidPassword) {
    throw new ApiError(httpStatusCodes.UNAUTHORIZED, "Invalid email or password");
  }

  return signToken(user);
}
