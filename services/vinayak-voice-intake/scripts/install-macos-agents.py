"""Install the two existing staff services as user LaunchAgents on a paired Mac."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team-root", type=Path, required=True)
    parser.add_argument("--session-root", type=Path, required=True, help="Existing paired bridge folder containing store/")
    parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--prepare-only", action="store_true", help="Write plists before retiring old foreground processes")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("macOS LaunchAgents are required.")
    os.umask(0o077)
    home = Path.home()
    team, session, runtime = [p.expanduser().resolve() for p in (args.team_root, args.session_root, args.runtime)]
    node = shutil.which("node")
    if not node:
        parser.error("Install Node 22.13 or newer.")
    users, store = team / "data/users.csv", session / "store"
    for file in [users, team / ".env", team / "clay.db", store / "messages.db", store / "whatsapp.db",
                 runtime / "bridge/vinayak-staff-bridge", runtime / "src/cli.mjs", runtime / "scripts/start-staff-bridge.mjs"]:
        if not file.is_file():
            parser.error(f"Missing {file}; supply the existing runtime and paired session.")
    jobs = {
        "com.teamclay.staff-bridge": [node, runtime / "scripts/start-staff-bridge.mjs", "--users", users, "--session-root", session],
        "com.teamclay.procurement-worker": [node, runtime / "src/cli.mjs", "--env-file", team / ".env", "--users", users,
            "--whatsapp-store", store, "--data-dir", team / "data/voice_notes", "--enable-chat", "--auto-reply", "--case-root", team],
    }
    domain = "gui/" + str(os.getuid())
    dest = home / "Library/LaunchAgents"
    logs = home / "Library/Application Support/TeamClay/Staff"
    dest.mkdir(exist_ok=True, parents=True)
    logs.mkdir(mode=0o700, exist_ok=True, parents=True)
    for label, argv in jobs.items():
        file = dest / (label + ".plist")
        data = plistlib.dumps({"Label": label, "ProgramArguments": list(map(str, argv)), "KeepAlive": True,
            "RunAtLoad": True, "ThrottleInterval": 10, "ExitTimeOut": 150, "Umask": 0o077,
            "EnvironmentVariables": {"TEAMCLAY_ROOT": str(team), "HOME": str(home)},
            "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null" if label.endswith("bridge") else str(logs / "worker.err")})
        if file.exists() and file.read_bytes() != data:
            parser.error(f"{file} already has different settings. Inspect it before replacing it.")
        if not file.exists():
            with file.open("xb") as output:
                output.write(data)
        if not args.prepare_only and subprocess.run(["launchctl", "print", domain + "/" + label], capture_output=True).returncode:
            subprocess.run(["launchctl", "bootstrap", domain, str(file)], check=True)
        print(label, "prepared" if args.prepare_only else "registered")


if __name__ == "__main__":
    main()
