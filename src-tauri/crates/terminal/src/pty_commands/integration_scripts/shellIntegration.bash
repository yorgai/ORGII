# Orgii terminal shell integration for bash
# Emits OSC 633 sequences for structured command detection.
#
# This file is used as --init-file. It sources the user's login/rc
# files before installing hooks.

if [[ -f ~/.bash_profile ]]; then
    . ~/.bash_profile
elif [[ -f ~/.bash_login ]]; then
    . ~/.bash_login
elif [[ -f ~/.profile ]]; then
    . ~/.profile
fi

[[ -f ~/.bashrc ]] && . ~/.bashrc

[[ "$-" == *i* ]] || return
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
__orgii_last_exit=0

__orgii_prompt_cmd() {
    __orgii_last_exit=$?
    if [[ "$__orgii_in_command" == "1" ]]; then
        __orgii_osc "D;$__orgii_last_exit"
        __orgii_in_command=0
    fi
    __orgii_report_cwd
    __orgii_osc "A"
}

__orgii_preexec() {
    if [[ "$BASH_COMMAND" == "$PROMPT_COMMAND" ]] || \
       [[ "$BASH_COMMAND" == "__orgii_prompt_cmd" ]]; then
        return
    fi
    __orgii_osc "E;$(__orgii_escape "$BASH_COMMAND")"
    __orgii_osc "C"
    __orgii_in_command=1
}

if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="__orgii_prompt_cmd"
else
    PROMPT_COMMAND="__orgii_prompt_cmd;$PROMPT_COMMAND"
fi

trap '__orgii_preexec' DEBUG

__orgii_report_cwd
__orgii_osc "A"
