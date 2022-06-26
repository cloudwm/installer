local http = require('http')
core.register_action("ipchecker", {'tcp-req'}, function(txn, name, clientid, secret, serverid)
    -- Get the frontend that was used
    -- Loop through all the backends. You could change this
    -- so that the backend names are passed into the function too.
    for _, backend in pairs(core.backends) do
        -- Look at only backends that have names that start with
        if backend and backend.name == name then
            -- Using the backend, loop through each of its servers
            for _, server in pairs(backend.servers) do
                -- Get server's stats
                local stats = server:get_stats()
                -- Get the backend's total number of current sessions
                if stats['status'] == 'DOWN' then
                     local url = "http://127.0.0.1:30080/svc/server/" .. serverid .. "/power/resume"
                     local method = "PUT"
                     -- local req_body = '{"power": "on"}'
                     local headers = {
                        ["Content-Type"] = "application/json";
                        ["AuthClientId"] = clientid;
                        ["AuthSecret"] = secret;
                     }
                     local socket = core.tcp()
                     socket:settimeout(timeout or 5)
                     local connect
                     if url:sub(1, 7) ~= "http://" and url:sub(1, 8) ~= "https://" then
                        url = "http://" .. url
                     end
                     local schema, host, req_uri = url:match("^(.*)://(.-)(/.*)$")
                     if not schema then
                     -- maybe path (request uri) is missing
                        schema, host = url:match("^(.*)://(.-)$")
                        if not schema then
                                return nil, "http." .. method:lower() .. ": Could not parse URL: " .. url
                        end
                        req_uri = "/"
                     end
                     local addr, port = host:match("(.*):(%d+)")
                     if schema == "http" then
                        connect = socket.connect
                        if not port then
                                addr = host
                                port = 80
                        end
                     elseif schema == "https" then
                        connect = socket.connect_ssl
                        if not port then
                                addr = host
                                port = 443
                        end
                     else
                        return nil, "http." .. method:lower() .. ": Invalid URL schema " .. tostring(schema)
                     end
                     local c, err = connect(socket, addr, port)
                     if c then
                        local req = {}
                        local hdr_tbl = {}
                        if headers then
                           for k, v in pairs(headers) do
                              if type(v) == "table" then
                                 table.insert(hdr_tbl, k .. ": " .. table.concat(v, ","))
                              else
                                 table.insert(hdr_tbl, k .. ": " .. tostring(v))
                              end
                            end
                        else
                           headers = {}  -- dummy table
                        end
                        if not headers.host then
                        -- 'Host' header must be provided for HTTP/1.1
                                table.insert(hdr_tbl, "host: " .. host)
                        end

                        if not headers["accept"] then
                                table.insert(hdr_tbl, "accept: */*")
                        end

                        if not headers["user-agent"] then
                                table.insert(hdr_tbl, "user-agent: haproxy-lua-http/1.0")
                        end

                        if not headers.connection then
                                table.insert(hdr_tbl, "connection: close")
                        end
                        if req_body then
                                req[4] = req_body
                                if not headers or not headers["content-length"] then
                                        table.insert(hdr_tbl, "content-length: " .. tostring(#req_body))
                                end
                        end

                        req[1] = method .. " " .. req_uri .. " HTTP/1.1\r\n"
                        req[2] = table.concat(hdr_tbl, "\r\n")
                        req[3] = "\r\n\r\n"

                        local r, e = socket:send(table.concat(req))

                        if not r then
                                socket:close()
                                return nil, "http." .. method:lower() .. ": " .. tostring(e)
                        end
                     end
                     while stats['status'] == 'DOWN' do
                             --core.sleep(1)
                     end
                     txn:set_var('req.blocked', false)
                     return
                else
                     txn:set_var('req.blocked', false)
                     return
                end
            end
        end
    end
end, 4)
