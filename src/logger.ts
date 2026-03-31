import chalk from "chalk";

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  debug: (msg: string) => {
    if (process.env.DEBUG === "true") {
      console.log(`${chalk.gray(timestamp())} ${chalk.magenta("DEBUG")} ${msg}`);
    }
  },
  info: (msg: string) => console.log(`${chalk.gray(timestamp())} ${chalk.blue("INFO")}  ${msg}`),
  success: (msg: string) => console.log(`${chalk.gray(timestamp())} ${chalk.green("OK")}    ${msg}`),
  warn: (msg: string) => console.warn(`${chalk.gray(timestamp())} ${chalk.yellow("WARN")}  ${msg}`),
  error: (msg: string) => console.error(`${chalk.gray(timestamp())} ${chalk.red("ERROR")} ${msg}`),
  section: (msg: string) => console.log(`\n${chalk.bold.cyan("=".repeat(60))}\n${chalk.bold.cyan(msg)}\n${"=".repeat(60)}`),
};
