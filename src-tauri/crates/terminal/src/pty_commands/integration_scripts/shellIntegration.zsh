# Orgii terminal shell integration for zsh
# Emits OSC 633 sequences for structured command detection.
#
# Sequences emitted:
#   A       — prompt start
#   C       — command executed (user pressed Enter)
#   D;<ec>  — command finished with exit code
#   E;<cmd> — command line text
#   P;Cwd=  — current working directory

[[ -o interactive ]] || return
[[ -n "$ORGII_SHELL_INTEGRATION" ]] && return
export ORGII_SHELL_INTEGRATION=1

__orgii_escape() {
    local val="$1"
    val="${val//\\/\\\\}"
    val="${val//;/\\x3b}"
    printf '%s' "$val"
}

__orgii_osc() {
    printf '\e]633;%s\a' "$1"
}

__orgii_report_cwd() {
    __orgii_osc "P;Cwd=$(__orgii_escape "$PWD")"
}

__orgii_in_command=0

__orgii_precmd() {
    local __orgii_ec=$?
    if [[ "$__orgii_in_command" == "1" ]]; then
        __orgii_osc "D;$__orgii_ec"
        __orgii_in_command=0
    fi
    __orgii_report_cwd
    __orgii_osc "A"
}

__orgii_preexec() {
    __orgii_osc "E;$(__orgii_escape "$1")"
    __orgii_osc "C"
    __orgii_in_command=1
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __orgii_precmd
add-zsh-hook preexec __orgii_preexec

__orgii_report_cwd
__orgii_osc "A"
