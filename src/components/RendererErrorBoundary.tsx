import React from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { logRendererError } from "../lib/rendererErrorLogger";

type State = {
  hasError: boolean;
};

export default class RendererErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logRendererError({
      type: "errorboundary",
      message: error.message || "Renderer error",
      stack: error.stack || info.componentStack,
    });
  }

  handleReload = () => {
    try {
      window.location.reload();
    } catch {
      // ignore
    }
  };

  handleOpenDiagnostics = async () => {
    try {
      const res = await window.api?.diagnosticsExportSupportBundle?.({
        signedIn: false,
      });
      if (res?.ok && res.path) {
        await window.api?.pathsOpen?.(res.path);
      }
    } catch {
      // ignore
    }
  };

  handleClose = () => {
    try {
      window.close();
    } catch {
      // ignore
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 3,
          backgroundColor: "background.default",
          color: "text.primary",
        }}
      >
        <Stack spacing={2} sx={{ maxWidth: 520 }}>
          <Typography variant="h5" fontWeight={700}>
            Something went wrong
          </Typography>
          <Typography variant="body1">
            ClipCast hit an unexpected UI error.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={this.handleReload}>
              Reload app
            </Button>
            <Button variant="outlined" onClick={this.handleOpenDiagnostics}>
              Open diagnostics
            </Button>
            <Button variant="text" onClick={this.handleClose}>
              Close
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  }
}
