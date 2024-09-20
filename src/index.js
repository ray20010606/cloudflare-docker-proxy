import DOCS from './help.html'

const dockerHub = "https://registry-1.docker.io";

const routes = {
  "docker.dockerray0606.org": "https://registry-1.docker.io",
  "quay.dockerray0606.org": "https://quay.io",
  "gcr.dockerray0606.org": "https://gcr.io",
  "k8s-gcr.dockerray0606.org": "https://k8s.gcr.io",
  "k8s.dockerray0606.org": "https://registry.k8s.io",
  "ghcr.dockerray0606.org": "https://ghcr.io",
  "cloudsmith.dockerray0606.org": "https://docker.cloudsmith.io",
};

// 添加事件监听器处理请求
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
});

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 如果路径为 "/"，返回 docs 页面
  if (url.pathname === "/") {
    return new Response(DOCS, {
      status: 200,
      headers: {
        "content-type": "text/html"
      }
    });
  }

  const upstream = routeByHosts(url.hostname);
  if (upstream === "") {
    return new Response(
      JSON.stringify({
        routes: routes,
      }),
      {
        status: 404,
      }
    );
  }

  const isDockerHub = upstream == dockerHub;
  const authorization = request.headers.get("Authorization");

  // 处理 Docker v2 认证请求
  if (url.pathname == "/v2/") {
    const newUrl = new URL(upstream + "/v2/");
    const headers = new Headers();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
    
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      headers: headers,
      redirect: "follow",
    });

    if (resp.status === 401) {
      const headers = new Headers();
      headers.set(
        "Www-Authenticate",
        `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`
      );
      return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
        status: 401,
        headers: headers,
      });
    } else {
      return resp;
    }
  }

  // 处理 Docker v2 的 token 获取
  if (url.pathname == "/v2/auth") {
    const newUrl = new URL(upstream + "/v2/");
    const resp = await fetch(newUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });

    if (resp.status !== 401) {
      return resp;
    }

    const authenticateStr = resp.headers.get("WWW-Authenticate");
    if (authenticateStr === null) {
      return resp;
    }

    const wwwAuthenticate = parseAuthenticate(authenticateStr);
    let scope = url.searchParams.get("scope");

    if (scope && isDockerHub) {
      let scopeParts = scope.split(":");
      if (scopeParts.length == 3 && !scopeParts[1].includes("/")) {
        scopeParts[1] = "library/" + scopeParts[1];
        scope = scopeParts.join(":");
      }
    }

    return await fetchToken(wwwAuthenticate, scope, authorization);
  }

  // DockerHub 路由重定向
  if (isDockerHub) {
    const pathParts = url.pathname.split("/");
    if (pathParts.length == 5) {
      pathParts.splice(2, 0, "library");
      const redirectUrl = new URL(url);
      redirectUrl.pathname = pathParts.join("/");
      return Response.redirect(redirectUrl, 301);
    }
  }

  // 转发请求到上游服务器
  const newUrl = new URL(upstream + url.pathname);
  const newReq = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });

  return await fetch(newReq);
}

function routeByHosts(host) {
  if (host in routes) {
    return routes[host];
  }
  if (MODE === "debug") {
    return TARGET_UPSTREAM;
  }
  return "";
}

function parseAuthenticate(authenticateStr) {
  const re = /(?<=\=")(?:\\.|[^"\\])*(?=")/g;
  const matches = authenticateStr.match(re);
  if (matches == null || matches.length < 2) {
    throw new Error(`invalid Www-Authenticate Header: ${authenticateStr}`);
  }
  return {
    realm: matches[0],
    service: matches[1],
  };
}

async function fetchToken(wwwAuthenticate, scope, authorization) {
  const url = new URL(wwwAuthenticate.realm);
  if (wwwAuthenticate.service.length) {
    url.searchParams.set("service", wwwAuthenticate.service);
  }
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  const headers = new Headers();
  if (authorization) {
    headers.set("Authorization", authorization);
  }
  return await fetch(url, { method: "GET", headers: headers });
}
