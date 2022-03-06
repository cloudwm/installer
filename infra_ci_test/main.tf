resource "random_shuffle" "dc" {
  input        = var.datacenter
  result_count = length(var.datacenter)
}

resource "kamatera_server" "my_server" {
  count         = length(var.image_id)
  name          = var.image_id[count.index].name
  password      = var.password
  datacenter_id = random_shuffle.dc.result[count.index % length(random_shuffle.dc.result)]
  cpu_type      = "B"
  cpu_cores     = 2
  ram_mb        = var.image_id[count.index].ram
  disk_sizes_gb = [10]
  image_id = "${random_shuffle.dc.result[count.index % length(random_shuffle.dc.result)]}:${var.image_id[count.index].id}"
  dynamic "network" {
    for_each = var.networks 
    content {
      name = network.value
    }
  }
}
