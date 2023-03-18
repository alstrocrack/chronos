zip it

```bash
  zip -r function.zip dist
```

release

```bash
  aws lambda update-function-code --function-name chronos --zip-file fileb://function.zip
```
