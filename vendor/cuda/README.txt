Place CUDA runtime DLLs here for Windows bundling:
- cublas64_12.dll
- cublasLt64_12.dll
- cudart64_12.dll
- (optional) cudnn64_8.dll

Use the script:
  node scripts/prepare-cuda-dlls.mjs

This folder is copied into the app bundle at:
  resources/python/Library/bin
