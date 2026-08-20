import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const parameters = { cost: 16384, blockSize: 8, parallelization: 1 };
const keyLength = 64;

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, keyLength, parameters);
  return [
    "scrypt-v1",
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString("base64url"),
    Buffer.from(hash).toString("base64url"),
  ].join("$");
}

/** @param {string} password @param {string} encoded */
export async function verifyPassword(password, encoded) {
  const [version, cost, blockSize, parallelization, salt, expected] =
    encoded.split("$");
  if (
    version !== "scrypt-v1" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !salt ||
    !expected
  ) {
    return false;
  }

  try {
    const expectedBuffer = Buffer.from(expected, "base64url");
    const actual = Buffer.from(
      await scrypt(
        password,
        Buffer.from(salt, "base64url"),
        expectedBuffer.length,
        {
          cost: Number(cost),
          blockSize: Number(blockSize),
          parallelization: Number(parallelization),
        },
      ),
    );
    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    );
  } catch {
    return false;
  }
}
