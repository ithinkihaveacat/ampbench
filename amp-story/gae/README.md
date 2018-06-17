Install dependencies:

```sh
$ yarn install-local-dependencies
$ yarn
```

Run locally:

```sh
$ tsc
$ yarn start
```

Deployment:

```sh
$ gcloud config set core/project PROJECT # set default project (if necessary)
$ yarn run deploy
```