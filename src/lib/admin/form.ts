import { parseMoney } from "@/lib/money";

/** Small, strict readers for FormData. Validation of meaning happens in the services. */

export function text(form: FormData, name: string, max = 4000) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function id(form: FormData, name: string) {
  const value = text(form, name, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new RangeError(`Missing or invalid ${name}.`);
  return value;
}

export function optionalInt(form: FormData, name: string) {
  const value = text(form, name, 20);
  if (!value) return null;
  if (!/^-?\d+$/.test(value)) throw new RangeError(`${name}: enter a whole number.`);
  return Number(value);
}

export function int(form: FormData, name: string) {
  const value = optionalInt(form, name);
  if (value === null) throw new RangeError(`${name}: required.`);
  return value;
}

export function checkbox(form: FormData, name: string) {
  return form.get(name) === "on" || form.get(name) === "true";
}

export function optionalMoney(form: FormData, name: string) {
  const value = text(form, name, 30);
  return value ? parseMoney(value) : null;
}

export function money(form: FormData, name: string) {
  const value = optionalMoney(form, name);
  if (value === null) throw new RangeError(`${name}: required.`);
  return value;
}

export function oneOf<T extends string>(form: FormData, name: string, allowed: readonly T[]): T {
  const value = text(form, name, 40);
  if (!(allowed as readonly string[]).includes(value)) throw new RangeError(`${name}: choose a valid option.`);
  return value as T;
}
