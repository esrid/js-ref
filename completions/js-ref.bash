_js_ref() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\n'
  COMPREPLY=($(compgen -W "$(js-ref --list-keys 2>/dev/null)" -- "$cur"))
}
complete -F _js_ref js-ref
