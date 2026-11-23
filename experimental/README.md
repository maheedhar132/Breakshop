EXPERIMENTAL AND UNTESTED: the container files in this folder have not been run yet. Treat them as a starting point.

# Containers (experimental)

The shop is the same code in every mode. Every setting comes from environment variables, so a process in a container behaves like one on your laptop:

| Variable | Meaning |
|---|---|
| `BS_HOST` | Address to listen on. Use `0.0.0.0` inside a container. |
| `BS_ALLOWED_HOSTS` | Extra host names that may reach admin endpoints (for example service names). |
| `BS_PORT` | Port to listen on. |
| `BS_DATA_DIR` | Where SQLite files live. Mount a volume here. |
| `BS_SUPERVISOR_URL` | Where the service directory is. |
| `BS_CONTROL_CENTER_URL` | Where business events are sent. |

## Docker Compose

`docker/compose.yml` has one container per process in `topology.json`. In containers the supervisor is not used: Compose starts and restarts each process, so the Control Center's copy and stop/start controls only work in native mode.

```
docker compose -f experimental/docker/compose.yml up --build
```

## Kubernetes (minikube)

`k8s/` has one Deployment and Service per process. Not applied or checked on a real cluster yet.

```
minikube start
kubectl apply -f experimental/k8s/
```
