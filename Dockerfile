# Scout sandbox image for readonly dynamic probes.
# Build: docker build -t scout-sandbox:latest .
# Then update your Scout sandbox policy or set SCOUT_SANDBOX_IMAGE=scout-sandbox:latest
#
# Based on node:20-alpine (the default Scout probe image) with Python added
# for multi-ecosystem probe support.

FROM node:20-alpine

# Add Python 3 for Python-ecosystem probes (pip --version, etc.)
RUN apk add --no-cache python3 py3-pip

# Safety: ensure no default credentials, SSH keys, or writable host paths
RUN rm -rf /root/.ssh /root/.npmrc /root/.pip && \
    mkdir -p /workspace && chmod 555 /workspace

# Scout probes mount source into /workspace read-only and run
# readonly commands (e.g. node --version, npm --version, python --version).
# No network, no package installs, no scripts.
WORKDIR /workspace

# Label for Scout probe identification
LABEL org.scout.sandbox=true
LABEL org.scout.version="0.4.1"
