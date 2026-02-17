import dotenv from "dotenv";

dotenv.config();

function must(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8081),
  jwtSecret: must("JWT_SECRET"),
  adminKey: must("ADMIN_KEY")
};
