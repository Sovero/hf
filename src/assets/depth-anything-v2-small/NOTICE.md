# Модель глубины: Depth Anything V2 Small (ONNX, uint8)

Файл `model_quantized.onnx` — **неизменённая копия** файла из репозитория
Hugging Face `onnx-community/depth-anything-v2-small`, путь `onnx/model_quantized.onnx`.

| | |
|---|---|
| Исходная модель | `depth-anything/Depth-Anything-V2-Small` (https://huggingface.co/depth-anything/Depth-Anything-V2-Small) |
| Источник ONNX-весов | https://huggingface.co/onnx-community/depth-anything-v2-small |
| Лицензия | Apache License 2.0 (текст — в файле `LICENSE` рядом; лицензия указана в карточке модели) |
| Размер | 27 258 801 байт |
| SHA-256 | `fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d` |
| Изменения в HueForge | нет — файл используется как есть |

Квантование (uint8) и конвертацию в ONNX выполнили авторы репозитория `onnx-community`,
не HueForge.

## Как получить файл заново и проверить

```bash
curl -L -o model_quantized.onnx \
  https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx
sha256sum model_quantized.onnx   # должно совпасть с суммой выше
```

Модель даёт **относительную** глубину (порядок «ближе / дальше»), а не расстояния в
миллиметрах. Другие размеры Depth Anything V2 (Base, Large) распространяются на иных
условиях (в частности некоммерческих) и в сборку не включены.
