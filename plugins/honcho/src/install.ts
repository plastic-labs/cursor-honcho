import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { getSettingsPath } from "./config.js";

export function checkHooksInstalled(): boolean {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) {
    return false;
  }
  try {
    const content = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    const hooks = settings.hooks;
    if (!hooks) return false;
    for (const event of Object.keys(hooks)) {
      const hookConfig = hooks[event];
      if (typeof hookConfig === "object" && hookConfig.command) {
        if (hookConfig.command.includes("honcho")) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function verifyCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
