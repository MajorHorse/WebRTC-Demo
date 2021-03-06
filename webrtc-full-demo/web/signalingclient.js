class SignalingClient {
  constructor() {
  }
  //socket.on():监听客户端发送的消息
  //socket.emit():给所有客户端广播消息
  connect(uri) {
    //当客户端成功加载socket.io客户端文件后会获取到一个全局对象io，我们将通过io.connect函数来向服务端发起连接请求。
    this.socket = io.connect(uri);
    this.socket.on('connect', async () => {
      this.onConnected();
    });

    this.socket.on('disconnect', () => {
      error('*** SocketIO disconnected!');
    });

    this.socket.on('connect_error', (err) => {
      error('*** SocketIO client connect error!' + err);
    });

    this.socket.on('connect_timeout', () => {
      error('*** SocketIO client connnect timeout!');
    });

    this.socket.on('error', () => {
      error('*** SocketIO error occors !' + error.name);
    });

    this.socket.on('notification', async (notification) => {
      const msg = notification.data;
      log("Receive'" + notification.method + "' message: " + JSON.stringify(msg));
      switch(notification.method) {
        case 'newPeer':
          this.onNewPeer(msg);
          break;
        case 'sdpAnswer':
          this.onSdpAnswer(msg);
          break;
        case 'sdpOffer':
          this.onSdpOffer(msg);
          break;
        case 'newIceCandidate' :
          this.onNewIceCandidate(msg);
          break;
      }
    });
  }

  sendRequest(method, data = null) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject('No socket connection.');
      } else {
        this.socket.emit('request', { method, data },
          this.timeoutCallback((err, response) => {
            if (err) {
              error('sendRequest %s timeout! socket: %o', method);
              reject(err);
            } else {
              resolve(response);
            }
          })
        );
      }
    });
  }

  timeoutCallback(callback) {
    let called = false;

    const interval = setTimeout(() => {
      if (called) {
        return;
      }
      called = true;
      callback(new Error('Request timeout.'));
    }, 5000);

    return (...args) => {
      if (called) {
        return;
      }
      called = true;
      clearTimeout(interval);

      callback(...args);
    };
  }
}