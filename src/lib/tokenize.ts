const tokenPattern = /[a-z0-9]+/g;

export function tokenize(input: string): string[] {
  return input.toLowerCase().match(tokenPattern) ?? [];
}
