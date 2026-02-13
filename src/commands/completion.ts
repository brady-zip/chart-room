import { Command } from "commander";
import { getCachePath } from "../lib/cache.js";

const BASH_SCRIPT = `# chart-room bash completion
# Add to ~/.bashrc: eval "$(chart-room completion bash)"

_chart_room_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="comment completion init link scan status test"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
    return
  fi

  case "\${prev}" in
    completion)
      COMPREPLY=($(compgen -W "bash zsh fish" -- "\${cur}"))
      return
      ;;
    comment|init|link|status|test)
      local cache_file="CACHE_PATH"
      if [[ -f "\${cache_file}" ]] && command -v jq &>/dev/null; then
        local paths=$(jq -r '.entries[].path' "\${cache_file}" 2>/dev/null)
        COMPREPLY=($(compgen -W "\${paths}" -- "\${cur}"))
      else
        COMPREPLY=($(compgen -f -X '!*.dash.json' -- "\${cur}"))
      fi
      return
      ;;
  esac

  COMPREPLY=($(compgen -f -- "\${cur}"))
}

complete -F _chart_room_completions chart-room
`;

const ZSH_SCRIPT = `# chart-room zsh completion
# Add to ~/.zshrc: eval "$(chart-room completion zsh)"

_chart_room() {
  local commands=(
    'comment:Add test dashboard link as PR comment'
    'completion:Output shell completion script'
    'init:Create [TEST] and prod dashboards in Datadog'
    'link:Link a dashboard file to existing Datadog dashboard'
    'scan:Scan project for dashboard files and update cache'
    'status:Show dashboard sync status'
    'test:Upload dashboard to [TEST] environment'
  )

  local shells=(bash zsh fish)

  _arguments -C \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe -t commands 'commands' commands
      ;;
    args)
      case \${words[2]} in
        completion)
          _values 'shell' $shells
          ;;
        comment|init|link|status|test)
          local cache_file="CACHE_PATH"
          if [[ -f "\${cache_file}" ]] && (( $+commands[jq] )); then
            local -a paths
            paths=(\${(f)"$(jq -r '.entries[].path' "\${cache_file}" 2>/dev/null)"})
            _values 'dashboard' $paths
          else
            _files -g '*.dash.json'
          fi
          ;;
        *)
          _files
          ;;
      esac
      ;;
  esac
}

compdef _chart_room chart-room
`;

const FISH_SCRIPT = `# chart-room fish completion
# Add to ~/.config/fish/completions/chart-room.fish

set -l commands comment completion init link scan status test
set -l shells bash zsh fish

complete -c chart-room -f

complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a comment -d 'Add test dashboard link as PR comment'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a init -d 'Create [TEST] and prod dashboards in Datadog'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a link -d 'Link a dashboard file to existing Datadog dashboard'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a status -d 'Show dashboard sync status'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a test -d 'Upload dashboard to [TEST] environment'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a scan -d 'Scan project for dashboard files and update cache'
complete -c chart-room -n "not __fish_seen_subcommand_from $commands" \\
  -a completion -d 'Output shell completion script'

complete -c chart-room -n "__fish_seen_subcommand_from completion" -a "$shells"

function __chart_room_dash_files
  set -l cache_file "CACHE_PATH"
  if test -f "$cache_file"; and type -q jq
    jq -r '.entries[].path' "$cache_file" 2>/dev/null
  else
    printf '%s\\n' *.dash.json **/*.dash.json 2>/dev/null
  end
end

complete -c chart-room -n "__fish_seen_subcommand_from comment init link status test" \\
  -a "(__chart_room_dash_files)"
`;

export const completionCommand = new Command()
  .name("completion")
  .description("Output shell completion script")
  .argument("<shell>", "Shell type (bash, zsh, fish)")
  .action((shell: string) => {
    const cachePath = getCachePath();
    let script: string;

    switch (shell) {
      case "bash":
        script = BASH_SCRIPT;
        break;
      case "zsh":
        script = ZSH_SCRIPT;
        break;
      case "fish":
        script = FISH_SCRIPT;
        break;
      default:
        console.error(`Unknown shell: ${shell}`);
        console.error("Supported shells: bash, zsh, fish");
        process.exit(1);
    }

    console.log(script.replaceAll("CACHE_PATH", cachePath));
  });
