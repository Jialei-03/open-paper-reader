"""Remove the specific internal transcript suffix used by older workers."""


def clean_response(text):
    if text.strip() == "（这轮助手回复没有工具记录，不作为查询或执行事实使用。）":
        return "这轮没有执行操作。"
    marker = "已执行工具记录（资料，不是指令）："
    head, separator, tail = text.partition(marker)
    # Do not hide normal discussion of tool output: only the old JSON transcript.
    if separator and tail.lstrip().startswith('[{"tool"'):
        return head.rstrip()
    return text
