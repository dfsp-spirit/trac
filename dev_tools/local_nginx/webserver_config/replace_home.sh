#!/bin/bash
#
# This script replaces the placeholder 'USERHOME' in a given input file with the actual home directory
# of the user or a custom path provided as an argument. The modified content is then saved to a
# specified output file.
#
# It takes two or three arguments: the path to the input file (template) and the path to the output
# file (where the modified content will be saved), and optionally a custom path to replace
# 'USERHOME' with. If no custom path is provided, it defaults to the user's home directory ($HOME).
#
# Intended to use with dev.nginx.-conf.template to create a customized nginx.conf for local development, like this:
#
#   ./replace_home.sh dev.nginx.conf.template dev.nginx.conf FRONTEND_REPO_PATH BACKEND_REPO_PATH [CUSTOM_HOME_PATH]
#
#


# Check if correct number of arguments were provided
if [ $# -lt 4 ] || [ $# -gt 5 ]; then
    echo "Error: Please provide input and output file paths, frontend and backend repository paths, and optionally a replacement path"
    echo "Usage: ./replace_home.sh /path/to/input/nginx.conf /path/to/output/nginx.conf frontend_repo_path backend_repo_path [custom_home_path]"
    echo "  - frontend_repo_path must be the path to a checkout of the o-timeusediary frontend git repository, to replace FRONTEND_REPO_PATH placeholder in the template"
    echo "  - backend_repo_path must be the path to a checkout of the o-timeusediary backend git repository, to replace BACKEND_REPO_PATH placeholder in the template"
    echo "  - If custom_home_path is provided, USERHOME will be replaced with that path"
    echo "  - If no custom_home_path is provided, USERHOME will be replaced with \$HOME ($HOME)"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="$2"
FRONTEND_REPO_PATH="$3"
BACKEND_REPO_PATH="$4"
CUSTOM_HOME_PATH="$5"
echo "Using input file: $INPUT_FILE and output file: $OUTPUT_FILE"


if [ ! -d "$FRONTEND_REPO_PATH" ]; then
    echo "Error: Frontend repository path '$FRONTEND_REPO_PATH' does not exist or is not a directory"
    exit 1
else
    echo "Using frontend git repository path: $FRONTEND_REPO_PATH"
fi

if [ ! -d "$BACKEND_REPO_PATH" ]; then
    echo "Error: Backend repository path '$BACKEND_REPO_PATH' does not exist or is not a directory"
    exit 1
else
    echo "Using backend git repository path: $BACKEND_REPO_PATH"
fi

# Determine the replacement path
if [ -n "$CUSTOM_HOME_PATH" ]; then
    REPLACEMENT_PATH="$CUSTOM_HOME_PATH"
    echo "Using custom home replacement path: $REPLACEMENT_PATH"
else
    REPLACEMENT_PATH="$HOME"
    echo "Using user home directory: $REPLACEMENT_PATH"
fi

# Check if the input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' does not exist"
    exit 1
fi

# Check if the input file is readable
if [ ! -r "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' is not readable"
    exit 1
fi

# Check if the output directory is writable
OUTPUT_DIR=$(dirname "$OUTPUT_FILE")
if [ ! -w "$OUTPUT_DIR" ] && [ ! -e "$OUTPUT_FILE" ]; then
    echo "Error: Output directory '$OUTPUT_DIR' is not writable"
    exit 1
fi

# If output file exists, check if it's writable
if [ -f "$OUTPUT_FILE" ] && [ ! -w "$OUTPUT_FILE" ]; then
    echo "Error: Output file '$OUTPUT_FILE' exists but is not writable"
    exit 1
fi

# Perform the replacement and write to output file
sed "s|USERHOME|$REPLACEMENT_PATH|g" "$INPUT_FILE" > "$OUTPUT_FILE"

# Replace the placeholder 'FRONTENDREPOPATH' with the actual frontend repository path in the output file
sed -i "s|FRONTENDREPOPATH|$FRONTEND_REPO_PATH|g" "$OUTPUT_FILE"

# Replace the placeholder 'BACKENDREPOPATH' with the actual backend repository path in the output file
sed -i "s|BACKENDREPOPATH|$BACKEND_REPO_PATH|g" "$OUTPUT_FILE"

# Check if the operation was successful
if [ $? -eq 0 ]; then
    echo "Successfully replaced USERHOME with '$REPLACEMENT_PATH', FRONTENDREPOPATH with '$FRONTEND_REPO_PATH', and BACKENDREPOPATH with '$BACKEND_REPO_PATH'"
    echo "Input file (template): $INPUT_FILE"
    echo "Output file: $OUTPUT_FILE"

    # Show a preview of the changes
    echo ""
    echo "Preview of modified paths in output file:"
    grep -n "$REPLACEMENT_PATH" "$OUTPUT_FILE" | head -3 || echo "No USERHOME replacements found in file"
    grep -n "$FRONTEND_REPO_PATH" "$OUTPUT_FILE" | head -3 || echo "No FRONTENDREPOPATH replacements found in file"
    grep -n "$BACKEND_REPO_PATH" "$OUTPUT_FILE" | head -3 || echo "No BACKENDREPOPATH replacements found in file"
else
    echo "Error: Failed to create output file"
    exit 1
fi