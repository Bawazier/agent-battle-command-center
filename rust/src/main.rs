use clap::{Parser, Subcommand};

mod agents;
mod broker;
mod db;
mod state;
mod tui;

#[derive(Parser)]
#[command(name = "battleclaw")]
#[command(version, about = "ABCC v2 — AI Agent Battle Command Center CLI")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Launch the interactive TUI dashboard
    Tui,
    /// Submit a task to the agent queue
    Run {
        /// Task description
        #[arg(short, long)]
        task: String,
        /// Target language (python, javascript, typescript, go, php)
        #[arg(short, long, default_value = "python")]
        lang: String,
    },
    /// Show task queue status
    Queue,
    /// Show agent logs
    Logs {
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
    },
    /// Manage model registry
    Models,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "battleclaw=info".into()),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Tui) | None => {
            println!("BattleClaw TUI — coming Day 2");
        }
        Some(Commands::Run { task, lang }) => {
            println!("Submitting task: {task:?} [{lang}]");
            println!("Agent broker — coming Day 3");
        }
        Some(Commands::Queue) => {
            println!("Task queue — coming Day 3");
        }
        Some(Commands::Logs { follow }) => {
            println!("Logs (follow={follow}) — coming Day 4");
        }
        Some(Commands::Models) => {
            println!("Model registry — coming Day 5");
        }
    }

    Ok(())
}
