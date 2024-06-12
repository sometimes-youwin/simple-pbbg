const DAYS_DIV = 1000 * 60 * 60 * 24;
const HOURS_DIV = DAYS_DIV / 24;
const MINUTES_DIV = HOURS_DIV / 60;
const SECONDS_DIV = MINUTES_DIV / 60;
const MILLISENDS_DIV = SECONDS_DIV / 1000;

export type TimeType = "DAYS" | "HOURS" | "MINUTES" | "SECONDS" | "MILLISECONDS";

/**
 * Referenced from https://stackoverflow.com/a/15289883
 * Dates are all in UTC anyways, so we can skip the conversion.
 * @param timeType The expected output type.
 * @param start The starting date.
 * @param end The ending date.
 * @returns The difference as a number according to the time type.
 */
export function timeBetween(timeType: TimeType, start: Date, end: Date) {
  // Default to 1 to output milliseconds
  let divisor: number = MILLISENDS_DIV;
  switch (timeType) {
    case "DAYS": {
      divisor = DAYS_DIV;
      break;
    }
    case "HOURS": {
      divisor = HOURS_DIV;
      break;
    }
    case "MINUTES": {
      divisor = MINUTES_DIV;
      break;
    }
    case "SECONDS": {
      divisor = SECONDS_DIV;
      break;
    }
    case "MILLISECONDS":
    default: {
      break;
    }
  }

  return Math.floor((end.getTime() - start.getTime()) / divisor);
}

/**
 * Get a date object representing the current time in UTC.
 * @returns The current datetime in UTC as a Date object.
 */
export function now() {
  return new Date(Date.now());
}
