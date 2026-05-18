"""Configuration management for MCP Gateway."""

import os
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Sentinel values treated as "unset" to fail-closed on misconfigured deploys.
# Includes the historical literal default and the .env.example placeholder so
# a copy-paste without edit still raises at startup.
_INSECURE_JWT_DEFAULTS = {
    "",
    "change-me-in-production",
    "CHANGE_ME_generate_with_openssl_rand_hex_32",
}
_MIN_JWT_SECRET_LEN = 32


class Settings(BaseSettings):
    """MCP Gateway configuration."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Service configuration
    service_name: str = "mcp-gateway"
    service_version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = 8001
    debug: bool = False

    # PostgreSQL configuration
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "agent_battle"
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    postgres_pool_min: int = 5
    postgres_pool_max: int = 20

    # Redis configuration
    redis_host: str = "redis"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: str | None = None
    redis_max_connections: int = 50

    # Sync configuration
    sync_from_postgres_interval: float = 1.0  # seconds
    sync_to_postgres_interval: float = 5.0  # seconds
    sync_batch_size: int = 100

    # Cache configuration
    task_cache_ttl: int = 3600  # 1 hour
    log_stream_ttl: int = 3600  # 1 hour
    file_lock_timeout: int = 60  # seconds

    # MCP configuration
    mcp_transport: str = "stdio"  # stdio or http
    mcp_server_name: str = "agent-collaboration-gateway"

    # Authentication
    jwt_secret: str = os.getenv("JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    jwt_expiration: int = 3600  # 1 hour

    @field_validator("jwt_secret")
    @classmethod
    def _require_strong_jwt_secret(cls, v: str) -> str:
        if v in _INSECURE_JWT_DEFAULTS:
            raise ValueError(
                "JWT_SECRET is unset or uses the insecure default. "
                "MCP Gateway refuses to start. Generate one with "
                "`openssl rand -hex 32` and set it in your .env."
            )
        if len(v) < _MIN_JWT_SECRET_LEN:
            raise ValueError(
                f"JWT_SECRET must be at least {_MIN_JWT_SECRET_LEN} chars "
                f"(got {len(v)}). Generate with `openssl rand -hex 32`."
            )
        return v

    # Monitoring
    enable_metrics: bool = True
    metrics_port: int = 9090

    @property
    def postgres_dsn(self) -> str:
        """Get PostgreSQL connection string."""
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def redis_url(self) -> str:
        """Get Redis connection URL."""
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"


# Global settings instance
settings = Settings()
