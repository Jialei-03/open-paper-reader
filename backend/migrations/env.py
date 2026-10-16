from alembic import context
from backend.config import Settings, database
from backend.models import Base

config = context.config
target_metadata = Base.metadata
if context.is_offline_mode():
    context.configure(
        url=Settings.env().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    engine, _ = database(Settings.env())
    with engine.connect() as connection:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=engine.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()

        if engine.dialect.name == "sqlite":
            violations = connection.exec_driver_sql(
                "PRAGMA foreign_key_check"
            ).fetchall()
            if violations:
                raise RuntimeError("Migration left invalid foreign keys")
            connection.commit()
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
