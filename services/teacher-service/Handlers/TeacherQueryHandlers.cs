using MediatR;
using TeacherService.Data;
using TeacherService.Models;

namespace TeacherService.Handlers;

public class GetTeacherListQuery : IRequest<TeacherListResponse>
{
    public required Guid SchoolId { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public class GetTeacherListHandler : IRequestHandler<GetTeacherListQuery, TeacherListResponse>
{
    private readonly ITeacherRepository _teacherRepository;

    public GetTeacherListHandler(ITeacherRepository teacherRepository)
    {
        _teacherRepository = teacherRepository;
    }

    public async Task<TeacherListResponse> Handle(GetTeacherListQuery request, CancellationToken cancellationToken)
    {
        var (teachers, totalCount) = await _teacherRepository.GetBySchoolAsync(request.SchoolId, request.Page, request.PageSize);
        return new TeacherListResponse
        {
            Page = request.Page,
            PageSize = request.PageSize,
            TotalCount = totalCount,
            Data = teachers.Select(t => t.ToDto()).ToList(),
        };
    }
}

public class GetTeacherCountQuery : IRequest<int>
{
    public required Guid SchoolId { get; set; }
}

public class GetTeacherCountHandler : IRequestHandler<GetTeacherCountQuery, int>
{
    private readonly ITeacherRepository _teacherRepository;

    public GetTeacherCountHandler(ITeacherRepository teacherRepository)
    {
        _teacherRepository = teacherRepository;
    }

    public async Task<int> Handle(GetTeacherCountQuery request, CancellationToken cancellationToken)
    {
        return await _teacherRepository.GetCountAsync(request.SchoolId);
    }
}
