# Orgii terminal shell integration for fish
# Emits OSC 633 sequences for structured command detection.

status is-interactive; or exit

if set -q ORGII_SHELL_INTEGRATION
    exit
end
set -gx ORGII_SHELL_INTEGRATION 1

function __orgii_escape
    string replace -a '\\' '\\\\' -- $argv[1] | string replace -a ';' '\\x3b'
end

function __orgii_osc
    printf '\e]633;%s\a' $argv[1]
end

function __orgii_report_cwd
    __orgii_osc "P;Cwd="(__orgii_escape "$PWD")
end

function __orgii_fish_prompt --on-event fish_prompt
    set -l ec $status
    if set -q __orgii_in_command
        __orgii_osc "D;$ec"
        set -e __orgii_in_command
    end
    __orgii_report_cwd
    __orgii_osc "A"
end

function __orgii_fish_preexec --on-event fish_preexec
    __orgii_osc "E;"(__orgii_escape "$argv[1]")
    __orgii_osc "C"
    set -g __orgii_in_command 1
end

function __orgii_fish_postexec --on-event fish_postexec
    # D is emitted in the next fish_prompt to capture $status correctly
end

function __orgii_fish_cancel --on-event fish_cancel
    __orgii_osc "D;0"
    set -e __orgii_in_command
end

__orgii_report_cwd
__orgii_osc "A"
