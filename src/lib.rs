//! Launch a local network server with live reload feature for static pages.
//!
//! ## Create live server
//! ```
//! use live_server::listen;
//!
//! async fn serve() -> Result<(), Box<dyn std::error::Error>> {
//!     listen("127.0.0.1:8080", "./").await?.start().await
//! }
//! ```
//!
//! ## Enable logs (Optional)
//! ```rust
//! env_logger::init();
//! ```

mod server;
mod watcher;

use std::{error::Error, path::PathBuf};

use axum::Router;
use notify::ReadDirectoryChangesWatcher;
use notify_debouncer_full::{DebouncedEvent, Debouncer, FileIdMap};
use server::{create_listener, create_server};
use tokio::{
    net::TcpListener,
    sync::{broadcast, mpsc::Receiver, OnceCell},
};
use watcher::create_watcher;

static ADDR: OnceCell<String> = OnceCell::const_new();
static ROOT: OnceCell<PathBuf> = OnceCell::const_new();
static TX: OnceCell<broadcast::Sender<()>> = OnceCell::const_new();

pub struct Listener {
    tcp_listener: TcpListener,
    router: Router,
    root_path: PathBuf,
    debouncer: Debouncer<ReadDirectoryChangesWatcher, FileIdMap>,
    rx: Receiver<Result<Vec<DebouncedEvent>, Vec<notify::Error>>>,
}

impl Listener {
    /// Start live-server
    /// 
    /// ```
    /// use live_server::listen;
    ///
    /// async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    ///     listen("127.0.0.1:8080", "./").await?.start().await
    /// }
    /// ```
    pub async fn start(self) -> Result<(), Box<dyn Error>> {
        ROOT.set(self.root_path.clone()).unwrap();
        let (tx, _) = broadcast::channel(16);
        TX.set(tx).unwrap();

        let watcher_future = tokio::spawn(watcher::watch(self.root_path, self.debouncer, self.rx));
        let server_future = tokio::spawn(server::serve(self.tcp_listener, self.router));

        tokio::try_join!(watcher_future, server_future)?;

        Ok(())
    }
}


/// Create live-server listener
/// 
/// ```
/// use live_server::listen;
///
/// async fn serve() -> Result<(), Box<dyn std::error::Error>> {
///     listen("127.0.0.1:8080", "./").await?.start().await
/// }
/// ```
pub async fn listen<A: Into<String>, R: Into<PathBuf>>(
    addr: A,
    root: R,
) -> Result<Listener, String> {
    let tcp_listener = create_listener(addr.into()).await?;
    let router = create_server();
    let (debouncer, root_path, rx) = create_watcher(root.into()).await?;

    Ok(Listener {
        tcp_listener,
        router,
        debouncer,
        root_path,
        rx,
    })
}
