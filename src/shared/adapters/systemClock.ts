import { Clock } from "../ports/Clock";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
