import { randomUUID } from "crypto";
import { IdGenerator } from "../ports/IdGenerator";

export class UuidIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
